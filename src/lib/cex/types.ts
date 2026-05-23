/**
 * Shared CEX types between the keystore (client) and the API routes (server).
 *
 * v1 supports read-only access — balance & orderbook. Trading endpoints will
 * come in a separate phase after the read flow has been validated.
 */

export type CexId = "binance" | "coinbase" | "okx";

export interface CexCredentials {
  apiKey:     string;
  apiSecret:  string;
  /** OKX uses a passphrase as a third leg. Other exchanges ignore it. */
  passphrase?: string;
  /** Whether the keys are marked "trade-only" by the user (no withdraw scope). */
  readOnly?:  boolean;
}

export interface CexBalance {
  asset:    string;
  free:     number;
  used:     number;
  total:    number;
  usdValue?: number;
}

export interface CexBalanceResponse {
  ok:        boolean;
  exchange:  CexId;
  balances:  CexBalance[];
  totalUsd:  number;
  fetchedAt: number;
}

export interface CexQuoteSide {
  price:  number;
  amount: number;
}

export interface CexOrderbookSnapshot {
  ok:       boolean;
  exchange: CexId;
  symbol:   string;
  /** Best bids (highest price first). */
  bids:     CexQuoteSide[];
  /** Best asks (lowest price first). */
  asks:     CexQuoteSide[];
  /** Mid price = (best bid + best ask) / 2 */
  mid:      number;
  /** Best ask price the user would pay buying market. */
  bestAsk:  number;
  /** Best bid price the user would receive selling market. */
  bestBid:  number;
  fetchedAt: number;
}

export const CEX_META: Record<CexId, {
  label:        string;
  color:        string;
  needsPassphrase: boolean;
  homepage:     string;
  keysDocsUrl:  string;
}> = {
  binance: {
    label:           "Binance",
    color:           "#F3BA2F",
    needsPassphrase: false,
    homepage:        "https://www.binance.com",
    keysDocsUrl:     "https://www.binance.com/en/support/faq/how-to-create-api-360002502072",
  },
  coinbase: {
    label:           "Coinbase Advanced",
    color:           "#0052FF",
    needsPassphrase: false,
    homepage:        "https://www.coinbase.com",
    keysDocsUrl:     "https://docs.cloud.coinbase.com/exchange/docs/creating-api-keys",
  },
  okx: {
    label:           "OKX",
    color:           "#FFFFFF",
    needsPassphrase: true,
    homepage:        "https://www.okx.com",
    keysDocsUrl:     "https://www.okx.com/account/my-api",
  },
};
