/* 보유세맵 공개판 설정 — 이 파일만 고치면 된다.
 *
 * VWORLD_KEY: VWorld 오픈API 인증키. 브라우저에서 쓰는 키이므로 공개되며,
 *   VWorld에 등록한 서비스 URL(도메인)에서만 동작한다. https://ella1-crypto.github.io 로 등록한 키를 넣는다.
 *   비워 두면 지도 조회 없이 '직접 입력'만 사용한다.
 * ADSENSE_CLIENT / ADSENSE_SLOT: 애드센스 승인 후 ca-pub-… 와 광고 단위 ID. 비우면 광고 영역을 숨긴다.
 * CONSULT_URL: 전문가 정밀검토 신청 링크(구글폼·카카오채널·예약 페이지 등). 비우면 버튼을 숨긴다.
 * PRO_URL: 유료 Pro(다물건·고지서 대사 엑셀) 판매 페이지. 비우면 버튼을 숨긴다.
 */
window.HTM_CONFIG = Object.freeze({
  VWORLD_KEY: '',
  VWORLD_DOMAIN: '', // 비우면 현재 페이지 호스트(ella1-crypto.github.io)를 사용
  ADSENSE_CLIENT: '',
  ADSENSE_SLOT: '',
  CONSULT_URL: '',
  CONSULT_LABEL: '세무 전문가 정밀검토 신청',
  PRO_URL: '',
  PRO_LABEL: 'Pro 엑셀 — 여러 물건·고지서 대사',
});
