import { useEffect, useState } from "preact/hooks";
import type { RefObject } from "preact";

const DEFAULT_ROW_HEIGHT = 53;
const DEFAULT_HEADER_HEIGHT = 44;
const DEFAULT_MIN_ROWS = 4;
const DEFAULT_MAX_ROWS = 80;
const DEFAULT_PAGINATION_RESERVE = 64;
const DEFAULT_BOTTOM_GAP = 16;

type UseDynamicPageSizeOptions = {
  rowHeight?: number;
  headerHeight?: number;
  minRows?: number;
  maxRows?: number;
  paginationReserve?: number;
  bottomGap?: number;
};

/** Fit as many table body rows as the viewport allows below `containerRef`. */
export function useDynamicPageSize(
  containerRef: RefObject<HTMLElement | null>,
  options: UseDynamicPageSizeOptions = {},
): number {
  const rowHeight = options.rowHeight ?? DEFAULT_ROW_HEIGHT;
  const headerHeight = options.headerHeight ?? DEFAULT_HEADER_HEIGHT;
  const minRows = options.minRows ?? DEFAULT_MIN_ROWS;
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  const paginationReserve =
    options.paginationReserve ?? DEFAULT_PAGINATION_RESERVE;
  const bottomGap = options.bottomGap ?? DEFAULT_BOTTOM_GAP;

  const [pageSize, setPageSize] = useState(minRows);

  useEffect(() => {
    function compute() {
      const el = containerRef.current;
      if (!el) {
        return;
      }
      const top = el.getBoundingClientRect().top;
      const available =
        window.innerHeight - top - paginationReserve - bottomGap - headerHeight;
      const rows = Math.floor(available / rowHeight);
      const next = Math.min(maxRows, Math.max(minRows, rows));
      setPageSize((current) => (current === next ? current : next));
    }

    compute();
    const frame = requestAnimationFrame(compute);

    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => compute())
        : null;
    if (observer && containerRef.current) {
      observer.observe(containerRef.current);
    }
    window.addEventListener("resize", compute);

    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", compute);
    };
  }, [
    containerRef,
    rowHeight,
    headerHeight,
    minRows,
    maxRows,
    paginationReserve,
    bottomGap,
  ]);

  return pageSize;
}
