export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function typeText(
  setter: (value: string) => void,
  text: string,
  charDelay: number,
  isMounted: { current: boolean },
): Promise<void> {
  return new Promise(resolve => {
    let i = 0
    const interval = setInterval(() => {
      if (!isMounted.current) { clearInterval(interval); resolve(); return }
      i++
      setter(text.slice(0, i))
      if (i >= text.length) { clearInterval(interval); resolve() }
    }, charDelay)
  })
}

export function animateCount(
  setter: (value: number) => void,
  total: number,
  stepDelay: number,
  isMounted: { current: boolean },
): Promise<void> {
  return new Promise(resolve => {
    let i = 0
    const interval = setInterval(() => {
      if (!isMounted.current) { clearInterval(interval); resolve(); return }
      i++
      setter(i)
      if (i >= total) { clearInterval(interval); resolve() }
    }, stepDelay)
  })
}
