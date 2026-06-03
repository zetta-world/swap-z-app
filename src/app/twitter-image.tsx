// Twitter card uses the same design as OpenGraph — single source of
// truth. Twitter's "summary_large_image" card has the same 1200x630
// aspect as OG, so re-exporting keeps both surfaces aligned with no
// drift when the brand evolves.

import OG from "./opengraph-image";

export const runtime = "edge";
export const alt = "Z-SWAP — The Liquidity Nexus · multi-chain DEX with ZION AI";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default OG;
