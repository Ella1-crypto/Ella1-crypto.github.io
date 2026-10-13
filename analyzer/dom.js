// DOM 생성 도우미. 모든 텍스트는 textContent 로만 넣는다(innerHTML 미사용).

export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function fill(target, ...children) {
  target.replaceChildren(...children.flat().filter(Boolean));
}

export const formatInt = (value) => (value === null || value === undefined ? '—' : Math.round(value).toLocaleString('ko-KR'));

export const formatPct = (value, digits = 1) => (
  value === null || value === undefined ? '—' : `${(value * 100).toFixed(digits)}%`
);

export function chip(text, tone = '') {
  return h('span', { class: `chip ${tone}`.trim(), text });
}

export function copyButton(getText, label = '복사') {
  const button = h('button', { class: 'btn', type: 'button', text: label });
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(getText());
      button.textContent = '복사됨';
    } catch (error) {
      button.textContent = '복사 실패 — 직접 선택해 복사';
    }
    setTimeout(() => { button.textContent = label; }, 1800);
  });
  return button;
}

export function meter(ratio, tone = '', targetRatio = null) {
  const clamped = Math.max(0, Math.min(1, ratio || 0));
  const bar = h('span', {});
  bar.style.transform = `scaleX(${clamped})`;
  const node = h('div', { class: `meter ${tone}`.trim(), role: 'presentation' }, bar);
  if (targetRatio !== null) {
    const mark = h('span', { class: 'target' });
    mark.style.left = `${Math.max(0, Math.min(1, targetRatio)) * 100}%`;
    node.append(mark);
  }
  return node;
}
