// Where the pop-in goes, in viewport coordinates. Pure, so it can be tested without a DOM.

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Placement {
  left: number;
  top: number;
  width: number;
  visible: boolean;
}

const gap = 4; // between the field and the pop-in
const margin = 4; // from the viewport's edges

// Under the field, aligned with its left edge; above it if there is more room there.
// Hidden while the field is scrolled out of view.
export function placePopin(field: Box, popin: Size, viewport: Size): Placement {
  const width = Math.max(0, Math.min(popin.width, viewport.width - 2 * margin));
  const left = Math.max(margin, Math.min(field.left, viewport.width - margin - width));
  const below = viewport.height - field.bottom - gap;
  const above = field.top - gap;
  const top = below >= popin.height || below >= above ? field.bottom + gap : Math.max(margin, field.top - gap - popin.height);
  const visible = field.bottom > 0 && field.top < viewport.height && field.right > 0 && field.left < viewport.width;
  return { left, top, width, visible };
}
