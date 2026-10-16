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

if [ -z "${VWORLD_KEY:-}" ]; then
  read -r -s -p "VWorld 인증키를 붙여 넣고 Enter (화면에 안 보임): " VWORLD_KEY; echo
fi
if ! [[ "$VWORLD_KEY" =~ ^[A-Za-z0-9-]{20,64}$ ]]; then echo "인증키 형식이 아닙니다."; exit 1; fi

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

ENV_JSON="{\"Variables\":{\"VWORLD_KEY\":\"$VWORLD_KEY\",\"VWORLD_DOMAIN\":\"ella1-crypto.github.io\",\"ALLOWED_ORIGINS\":\"$ORIGIN\"}}"

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
unset VWORLD_KEY ENV_JSON

echo "5/5 확인"
sleep 3
curl -s -m 20 -H "Origin: $ORIGIN" "${URL%/}/search?q=%EC%97%AD%EC%82%BC%EB%8F%99%20825" | head -c 200; echo
echo
echo "중계 서버 주소: ${URL%/}"
echo "이 주소를 Claude에게 알려 주세요."
