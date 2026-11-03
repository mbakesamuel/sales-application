import type { RefObject } from "preact";
type UseDynamicPageSizeOptions = {
    rowHeight?: number;
    headerHeight?: number;
    minRows?: number;
    maxRows?: number;
    paginationReserve?: number;
    bottomGap?: number;
};
/** Fit as many table body rows as the viewport allows below `containerRef`. */
export declare function useDynamicPageSize(containerRef: RefObject<HTMLElement | null>, options?: UseDynamicPageSizeOptions): number;
export {};
