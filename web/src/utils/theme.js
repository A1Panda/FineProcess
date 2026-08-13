/**
 * 主题切换工具：浅色 / 深色（Apple 风格）
 * - 通过 html[data-theme="dark"] 驱动 CSS 变量切换
 * - 偏好持久化到 localStorage，未设置时跟随系统
 * - 切换时从触发按钮位置扩散圆形「揭示层」：
 *   克隆当前页面内容并强制应用目标主题变量，用 clip-path 圆裁切，
 *   圆内显示新主题内容、圆外保留旧主题内容（iOS 原生效果），
 *   扩散完成时切换真实页面主题并移除克隆层。
 */

const KEY = 'kgd-theme'
const REVEAL_MS = 620 // 扩散动画时长

const prefersReduced = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** 当前是否为深色 */
export function isDark() {
  return document.documentElement.getAttribute('data-theme') === 'dark'
}

/** 应用主题（light / dark / auto） */
export function applyTheme(mode) {
  const dark = mode === 'dark' || (mode === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
  return dark
}

/** 读取指定主题模式下 :root 的全部 CSS 变量（同步读写，浏览器不会中间重绘） */
function collectThemeVars(mode) {
  const html = document.documentElement
  const prev = html.getAttribute('data-theme')
  html.setAttribute('data-theme', mode)
  const style = getComputedStyle(html)
  const vars = []
  for (let i = 0; i < style.length; i++) {
    const name = style[i]
    if (name.startsWith('--')) vars.push([name, style.getPropertyValue(name).trim()])
  }
  html.setAttribute('data-theme', prev)
  return vars
}

/**
 * 从触发元素位置创建圆形扩散揭示层（内容随圆变色），返回切换后是否为深色
 * @param {HTMLElement} [originEl] 触发按钮，缺省时直接切换无动画
 */
export function toggleTheme(originEl) {
  const html = document.documentElement
  const next = html.getAttribute('data-theme') !== 'dark'
  const appEl = document.getElementById('app')

  const canAnimate = originEl && appEl && !prefersReduced() && !document.querySelector('.theme-reveal')

  if (!canAnimate) {
    setTheme(next)
    return next
  }

  // 圆心 = 按钮中心；半径 = 圆心到屏幕最远角，保证覆盖整个视口
  const rect = originEl.getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const radius = Math.ceil(Math.hypot(Math.max(cx, window.innerWidth - cx), Math.max(cy, window.innerHeight - cy)))

  // 1. 克隆当前页面内容作为新主题图层
  const clone = appEl.cloneNode(true)
  clone.id = 'theme-reveal-app'
  const layer = document.createElement('div')
  layer.className = 'theme-reveal'
  // 兜底背景：与目标主题背景色一致，防止圆内/切换瞬间露出未着色背景
  layer.style.background = next ? '#000000' : '#f2f2f7'
  // 内联目标主题的全部 CSS 变量，克隆内容因此渲染为新主题颜色
  for (const [name, value] of collectThemeVars(next ? 'dark' : 'light')) {
    layer.style.setProperty(name, value)
  }
  // 同步表单值：cloneNode 不复制 input/textarea 已输入的内容，
  // 若不同步，扩散圆经过输入框时文字会“消失”，切换完成后又出现，产生闪烁
  const srcInputs = appEl.querySelectorAll('input, textarea, select')
  const dstInputs = clone.querySelectorAll('input, textarea, select')
  srcInputs.forEach((src, i) => {
    const dst = dstInputs[i]
    if (dst) dst.value = src.value
  })
  // 初始圆半径为 0（圆心在按钮处）
  layer.style.clipPath = `circle(0px at ${cx}px ${cy}px)`
  layer.appendChild(clone)
  document.body.appendChild(layer)
  // 同步滚动位置：让克隆层作为滚动容器滚动到与真实页面一致，
  // sticky 头部（搜索框/分段按钮所在）才能与真实页面精确对齐
  layer.scrollTop = window.scrollY

  // 2. 下一帧触发扩散动画
  requestAnimationFrame(() => {
    layer.style.clipPath = `circle(${radius}px at ${cx}px ${cy}px)`
  })

  // 3. 动画结束后切换真实主题：
  //    - 先禁用真实页面一切过渡，让元素瞬间完成新主题重绘（无渐变半程态）
  //    - 等真实页面完成重绘（两帧）后再移除克隆层，画面无缝衔接
  window.setTimeout(() => {
    setTheme(next)
    html.classList.add('theme-lock')
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        layer.remove()
        html.classList.remove('theme-lock')
      })
    })
  }, REVEAL_MS + 60)

  return next
}

/** 写入主题属性并持久化 */
function setTheme(dark) {
  const html = document.documentElement
  html.setAttribute('data-theme', dark ? 'dark' : 'light')
  try {
    localStorage.setItem(KEY, dark ? 'dark' : 'light')
  } catch {
    /* 隐私模式等场景忽略 */
  }
}

/** 初始化：优先取本地偏好，否则跟随系统 */
export function initTheme() {
  let saved = null
  try {
    saved = localStorage.getItem(KEY)
  } catch {
    /* ignore */
  }
  applyTheme(saved || 'auto')
  // 系统主题变化时自动跟随（仅当用户未手动设置过）
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', (e) => {
    if (!localStorage.getItem(KEY)) applyTheme('auto')
  })
}
