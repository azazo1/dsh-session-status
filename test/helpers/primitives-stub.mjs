/**
 * `@deepseek-ai/dsh-client-ui-primitives` 的测试替身.
 *
 * 客户端 bundle 现在 require 宿主的原生原子 (Menu / Tooltip / Switch / Input / Button).
 * 真实实现躺在 DSH 检出里 (TS + CSS modules), 测试跑不动, 所以这里按用到的子集给最小替身:
 * 结构够断言即可, 视觉与键盘走查本来就归宿主负责.
 *
 * 替身用调用方给的 react 实例建元素, 保证和 bundle 拿到的是同一份 react
 * (测试里既有真实 React, 也有 hooks mock).
 */
export const PRIMITIVES_MODULE = '@deepseek-ai/dsh-client-ui-primitives'

/** 用给定 react 造一套替身组件. */
export function createPrimitivesStub(react) {
  /** 提示气泡: 真实实现是 cloneElement + portal, 这里只把锚点透传出来. */
  function Tooltip(props) {
    // hooks mock 的 createElement 会把子节点收成数组, 真实 React 则是单元素.
    return Array.isArray(props.children) ? props.children[0] : props.children
  }

  /** 下拉菜单: 打开时把 items 摊成可点按钮, 选中态挂在 aria-checked 上. */
  function Menu(props) {
    const children = [props.anchor]
    if (props.open) {
      for (const item of props.items || []) {
        if (item.type === 'separator') {
          children.push(react.createElement('div', { key: item.id, role: 'separator' }))
          continue
        }
        children.push(react.createElement('button', {
          key: item.id,
          type: 'button',
          role: 'menuitem',
          'aria-checked': props.selectedId === item.id ? 'true' : 'false',
          'data-menu-item': item.id,
          onClick: () => { if (props.onSelect) props.onSelect(item.id) },
        }, item.icon, item.label))
      }
    }
    return react.createElement('div', {
      className: props.className,
      'data-menu-open': props.open ? 'true' : 'false',
    }, ...children)
  }

  /** 开关: 真实实现是 role="switch" 的按钮, 这里保留语义与 onChange(next). */
  function Switch(props) {
    return react.createElement('button', {
      type: 'button',
      role: 'switch',
      'aria-checked': props.checked ? 'true' : 'false',
      'aria-label': props.label,
      disabled: props.disabled === true,
      onClick: () => { if (props.onChange) props.onChange(!props.checked) },
    })
  }

  /** 输入框: 真实实现是 span 包 input, 属性透传给内层 input. */
  function Input(props) {
    const rest = { ...props }
    delete rest.icon
    const className = rest.className
    delete rest.className
    return react.createElement('span', { className }, react.createElement('input', rest))
  }

  /** 按钮: 视觉变体无关紧要, 保留 className 与原生属性. */
  function Button(props) {
    const rest = { ...props }
    delete rest.variant
    delete rest.size
    delete rest.icon
    const children = rest.children
    delete rest.children
    // hooks mock 与真实 React 的 children 形态不同, 统一摊平后再传.
    const list = Array.isArray(children) ? children : [children]
    return react.createElement('button', { type: 'button', ...rest }, ...list)
  }

  /** 图标: 真实实现是 16 视框的描边 SVG, 这里给个同形 svg 便于断言. */
  function IconChevronDownOutlineRegular(props) {
    const size = props.size === undefined ? 14 : props.size
    return react.createElement('svg', {
      'data-icon': 'chevron-down',
      viewBox: '0 0 16 16',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
    })
  }

  return { Button, IconChevronDownOutlineRegular, Input, Menu, Switch, Tooltip }
}
