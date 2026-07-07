import { assertAppPassword, handleOptions, jsonResponse, searchFlightOffers, searchMonthlyFlightOffers, normalizeMonthList } from "./_shared";

export default async (req: Request) => {
  const options = handleOptions(req);
  if (options) return options;

  try {
    assertAppPassword(req);
    if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

    const body = await req.json();
    const searchMode = body.searchMode || body.search_mode || "exact";

    if (searchMode === "month_range") {
      const result = await searchMonthlyFlightOffers({
        origin: body.origin || "ICN",
        destination: body.destination || "NCE",
        months: normalizeMonthList(body.departureMonths || body.departure_months),
        tripLengthDays: Number(body.tripLengthDays || body.trip_length_days || 7),
        adults: Number(body.adults || 1),
        currency: body.currency || "KRW",
        maxPerDate: 2,
      });
      return jsonResponse({ ...result, searchMode: "month_range" });
    }

    const offers = await searchFlightOffers({
      origin: body.origin || "ICN",
      destination: body.destination || "NCE",
      departureDate: body.departureDate,
      returnDate: body.returnDate || null,
      adults: Number(body.adults || 1),
      currency: body.currency || "KRW",
      max: 10,
    });

    return jsonResponse({ offers, searchMode: "exact" });
  } catch (error: any) {
    return jsonResponse({ error: error.message || "Unknown error" }, error.status || 500);
  }
};
