import '@testing-library/jest-dom'

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => ([] as unknown as DOMRectList)
}
