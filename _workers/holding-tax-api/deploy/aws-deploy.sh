#!/usr/bin/env bash
# 보유세맵 중계 서버를 AWS Lambda(서울)에 올린다 — AWS CloudShell(ap-northeast-2)에서 실행.
#   bash deploy/aws-deploy.sh
# 다시 실행하면 코드·설정만 갱신한다(역할·함수 URL은 그대로).
set -euo pipefail

REGION=ap-northeast-2
FN=holding-tax-relay
ROLE=holding-tax-relay-role
ORIGIN=https://ella1-crypto.github.io
cd "$(dirname "$0")/.."

# 이미 배포된 함수가 있으면 저장된 키를 그대로 쓴다(Enter만 누르면 유지)
current_env() {
  aws lambda get-function-configuration --function-name "$FN" --region "$REGION"     --query "Environment.Variables.$1" --output text 2>/dev/null | grep -v '^None$' || true
}
if [ -z "${VWORLD_KEY:-}" ]; then
  read -r -s -p "VWorld 인증키 (화면에 안 보임, 기존 값 유지는 Enter): " VWORLD_KEY; echo
  [ -z "$VWORLD_KEY" ] && VWORLD_KEY=$(current_env VWORLD_KEY)
fi
if ! [[ "$VWORLD_KEY" =~ ^[A-Za-z0-9-]{20,64}$ ]]; then echo "VWorld 인증키 형식이 아닙니다."; exit 1; fi
if [ -z "${BLD_KEY:-}" ]; then
  read -r -s -p "공공데이터포털 건축물대장 일반 인증키(Decoding) (화면에 안 보임, 기존 값 유지·생략은 Enter): " BLD_KEY; echo
  [ -z "$BLD_KEY" ] && BLD_KEY=$(current_env BLD_KEY)
fi
BLD_KEY=$(printf '%s' "$BLD_KEY" | tr -d '[:space:]')                      # 복사할 때 딸려 온 공백·줄바꿈 제거
if [[ "$BLD_KEY" == *%* ]]; then BLD_KEY=$(printf '%b' "${BLD_KEY//%/\\x}"); echo "   Encoding 키를 Decoding 키로 바꿨습니다."; fi
if [ -n "$BLD_KEY" ] && ! [[ "$BLD_KEY" =~ ^[A-Za-z0-9+/=-]{20,200}$ ]]; then
  echo "건축물대장 인증키 형식이 아닙니다 (길이 ${#BLD_KEY}자, 허용 밖 문자: $(printf '%s' "$BLD_KEY" | tr -d 'A-Za-z0-9+/=-' | od -An -c | tr -s ' ' | head -c 40))."; exit 1
fi
[ -z "$BLD_KEY" ] && echo "   건축물대장 키 없음 — /building은 503을 돌려줍니다."

echo "1/5 실행 역할 확인"
if ! ROLE_ARN=$(aws iam get-role --role-name "$ROLE" --query Role.Arn --output text 2>/dev/null); then
  ROLE_ARN=$(aws iam create-role --role-name "$ROLE" \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
    --query Role.Arn --output text)
  aws iam attach-role-policy --role-name "$ROLE" --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  echo "   역할을 만들었습니다. 권한이 퍼지도록 15초 기다립니다…"; sleep 15
fi

echo "2/5 코드 묶기"
rm -f /tmp/relay.zip
zip -q -r /tmp/relay.zip lambda.mjs memory-cache.mjs package.json src

# 손으로 넣어 둔 다른 환경변수(BLD_BASE 등)는 그대로 두고 키·출처만 덮어쓴다
OLD_ENV=$(aws lambda get-function-configuration --function-name "$FN" --region "$REGION" --query Environment.Variables --output json 2>/dev/null || true)
[ -z "$OLD_ENV" ] || [ "$OLD_ENV" = "null" ] && OLD_ENV='{}'
ENV_JSON=$(jq -cn --argjson old "$OLD_ENV" --arg v "$VWORLD_KEY" --arg b "$BLD_KEY" --arg o "$ORIGIN"   '{Variables: ($old + {VWORLD_KEY: $v, VWORLD_DOMAIN: "ella1-crypto.github.io", ALLOWED_ORIGINS: $o} + (if $b == "" then {} else {BLD_KEY: $b} end))}')

echo "3/5 함수 만들기·갱신"
if aws lambda get-function --function-name "$FN" --region "$REGION" >/dev/null 2>&1; then
  aws lambda update-function-code --function-name "$FN" --region "$REGION" --zip-file fileb:///tmp/relay.zip >/dev/null
  aws lambda wait function-updated --function-name "$FN" --region "$REGION"
  aws lambda update-function-configuration --function-name "$FN" --region "$REGION" --environment "$ENV_JSON" >/dev/null
else
  aws lambda create-function --function-name "$FN" --region "$REGION" \
    --runtime nodejs22.x --architectures arm64 --handler lambda.handler \
    --role "$ROLE_ARN" --zip-file fileb:///tmp/relay.zip \
    --timeout 20 --memory-size 256 --environment "$ENV_JSON" >/dev/null
fi
aws lambda wait function-active --function-name "$FN" --region "$REGION"
aws lambda wait function-updated --function-name "$FN" --region "$REGION"

echo "4/5 공개 주소(함수 URL)"
if ! URL=$(aws lambda get-function-url-config --function-name "$FN" --region "$REGION" --query FunctionUrl --output text 2>/dev/null); then
  URL=$(aws lambda create-function-url-config --function-name "$FN" --region "$REGION" --auth-type NONE --query FunctionUrl --output text)
  # 누구나 호출할 수 있게(허용 출처·요청 제한은 코드가 검사한다)
  aws lambda add-permission --function-name "$FN" --region "$REGION" --statement-id public-url \
    --action lambda:InvokeFunctionUrl --principal '*' --function-url-auth-type NONE >/dev/null
  aws lambda add-permission --function-name "$FN" --region "$REGION" --statement-id public-invoke \
    --action lambda:InvokeFunction --principal '*' --invoked-via-function-url >/dev/null 2>&1 || true
fi
unset VWORLD_KEY BLD_KEY ENV_JSON OLD_ENV

echo "5/5 확인"
sleep 3
curl -s -m 20 -H "Origin: $ORIGIN" "${URL%/}/search?q=%EC%97%AD%EC%82%BC%EB%8F%99%20825" | head -c 200; echo
echo
echo "중계 서버 주소: ${URL%/}"
echo "이 주소를 Claude에게 알려 주세요."
