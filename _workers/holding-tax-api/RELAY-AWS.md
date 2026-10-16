# 보유세맵 중계 서버 — AWS Lambda 서울에 올리기

VWorld는 해외 IP와 Cloudflare IP를 막습니다.
- Oracle 오사카: `https://api.vworld.kr`이 `000`으로 막혔습니다.
- AWS 서울: 같은 시험이 `200`에 `status OK`로 통과했습니다(2026-10-16 CloudShell 실측).

그래서 중계 서버를 **AWS Lambda 서울(ap-northeast-2)**에 둡니다.

```
브라우저(ella1-crypto.github.io)
  → https://<id>.lambda-url.ap-northeast-2.on.aws (함수 URL, HTTPS)
  → lambda.mjs → src/index.js (Worker와 같은 코드)
  → https://api.vworld.kr
```

## 배포 (CloudShell, 서울 리전에서 3줄)

```bash
git clone --depth 1 https://github.com/Ella1-crypto/Ella1-crypto.github.io.git site
cd site/_workers/holding-tax-api
bash deploy/aws-deploy.sh
```

인증키를 물으면 VWorld 인증키를 붙여 넣으세요. 화면에는 보이지 않습니다. 끝나면 `중계 서버 주소: https://….lambda-url.ap-northeast-2.on.aws`가 나옵니다. 그 주소를 `holding-tax/js/config.js`의 `API_BASE`에 넣으면 됩니다.

코드를 고친 뒤에는 `git pull && bash deploy/aws-deploy.sh`로 다시 실행하세요. 역할과 주소는 그대로 두고 코드·설정만 갱신합니다.

## 비용

- Lambda: 월 100만 요청, 40만 GB-초까지 무료입니다. 이 함수는 256MB에 요청당 1초 안팎이라 한도의 1%도 안 씁니다.
- 함수 URL은 추가 요금이 없습니다. 밖으로 나가는 데이터는 월 100GB까지 무료입니다.

## 보안

- 키는 Lambda 환경변수에만 있습니다(AWS가 저장할 때 암호화). 저장소에는 올리지 않습니다.
- 허용 출처는 `https://ella1-crypto.github.io`뿐이고, 다른 사이트의 브라우저 요청은 403입니다.
- 요청 제한은 함수 URL이 알려 주는 실제 접속 IP 기준으로 분당 90회입니다(실행 환경 단위의 근사치).
- 함수 URL은 공개(`auth-type NONE`)입니다. 브라우저에서 바로 불러야 하기 때문입니다.

## 운영

- 로그: CloudWatch → 로그 그룹 `/aws/lambda/holding-tax-relay`
- 삭제: `aws lambda delete-function --function-name holding-tax-relay --region ap-northeast-2`
