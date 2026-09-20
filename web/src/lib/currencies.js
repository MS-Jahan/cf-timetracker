/**
 * Currency catalog for pickers and money formatting.
 *
 * The list covers the currencies a small studio actually bills in; anything else can
 * still be typed manually as a 3-letter ISO 4217 code — `currencyName`/`currencySymbol`
 * simply return "" and `formatMoney` falls back to Intl's own knowledge of the code.
 */
export const CURRENCIES = [
  { code: "USD", name: "US Dollar", symbol: "$" },
  { code: "EUR", name: "Euro", symbol: "€" },
  { code: "GBP", name: "British Pound", symbol: "£" },
  { code: "JPY", name: "Japanese Yen", symbol: "¥" },
  { code: "CNY", name: "Chinese Yuan", symbol: "¥" },
  { code: "INR", name: "Indian Rupee", symbol: "₹" },
  { code: "AUD", name: "Australian Dollar", symbol: "$" },
  { code: "CAD", name: "Canadian Dollar", symbol: "$" },
  { code: "CHF", name: "Swiss Franc", symbol: "Fr" },
  { code: "HKD", name: "Hong Kong Dollar", symbol: "$" },
  { code: "SGD", name: "Singapore Dollar", symbol: "$" },
  { code: "NZD", name: "New Zealand Dollar", symbol: "$" },
  { code: "SEK", name: "Swedish Krona", symbol: "kr" },
  { code: "NOK", name: "Norwegian Krone", symbol: "kr" },
  { code: "DKK", name: "Danish Krone", symbol: "kr" },
  { code: "PLN", name: "Polish Zloty", symbol: "zł" },
  { code: "CZK", name: "Czech Koruna", symbol: "Kč" },
  { code: "HUF", name: "Hungarian Forint", symbol: "Ft" },
  { code: "RON", name: "Romanian Leu", symbol: "lei" },
  { code: "TRY", name: "Turkish Lira", symbol: "₺" },
  { code: "RUB", name: "Russian Ruble", symbol: "₽" },
  { code: "UAH", name: "Ukrainian Hryvnia", symbol: "₴" },
  { code: "BRL", name: "Brazilian Real", symbol: "R$" },
  { code: "MXN", name: "Mexican Peso", symbol: "$" },
  { code: "ARS", name: "Argentine Peso", symbol: "$" },
  { code: "CLP", name: "Chilean Peso", symbol: "$" },
  { code: "COP", name: "Colombian Peso", symbol: "$" },
  { code: "PEN", name: "Peruvian Sol", symbol: "S/" },
  { code: "ZAR", name: "South African Rand", symbol: "R" },
  { code: "NGN", name: "Nigerian Naira", symbol: "₦" },
  { code: "KES", name: "Kenyan Shilling", symbol: "KSh" },
  { code: "EGP", name: "Egyptian Pound", symbol: "E£" },
  { code: "AED", name: "UAE Dirham", symbol: "د.إ" },
  { code: "SAR", name: "Saudi Riyal", symbol: "﷼" },
  { code: "QAR", name: "Qatari Riyal", symbol: "ر.ق" },
  { code: "KWD", name: "Kuwaiti Dinar", symbol: "د.ك" },
  { code: "ILS", name: "Israeli Shekel", symbol: "₪" },
  { code: "PKR", name: "Pakistani Rupee", symbol: "₨" },
  { code: "BDT", name: "Bangladeshi Taka", symbol: "৳" },
  { code: "LKR", name: "Sri Lankan Rupee", symbol: "₨" },
  { code: "IDR", name: "Indonesian Rupiah", symbol: "Rp" },
  { code: "MYR", name: "Malaysian Ringgit", symbol: "RM" },
  { code: "THB", name: "Thai Baht", symbol: "฿" },
  { code: "PHP", name: "Philippine Peso", symbol: "₱" },
  { code: "VND", name: "Vietnamese Dong", symbol: "₫" },
  { code: "KRW", name: "South Korean Won", symbol: "₩" },
  { code: "TWD", name: "New Taiwan Dollar", symbol: "$" },
];

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

export const currencyName = (code) => BY_CODE.get(code)?.name || "";
export const currencySymbol = (code) => BY_CODE.get(code)?.symbol || "";

/** "USD — US Dollar ($)" style label for dropdown options and hints. */
export function currencyLabel(code) {
  const entry = BY_CODE.get(code);
  if (entry) return `${entry.name} (${entry.symbol})`;
  return code ? "Custom code" : "";
}

/** Short description under a currency input: name + symbol, or a manual-code hint. */
export function currencyHint(code) {
  const entry = BY_CODE.get(code);
  if (entry) return `${entry.name} · ${entry.symbol}`;
  if (!code) return "3-letter ISO code, e.g. USD";
  return "Custom code";
}

/** True when the code is in the catalog. Unknown codes still work through Intl if valid. */
export const isKnownCurrency = (code) => BY_CODE.has(code);
