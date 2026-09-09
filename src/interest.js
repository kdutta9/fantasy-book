// THE INTEREST (DESIGN.md §6.2). Fourth place in Nick's is playing for the
// interest the pot has earned sitting in a savings account, and that number goes
// up every day. It is computed HERE, in the browser, and not in the builder:
// reading a clock at build time would make every rebuild differ and break the
// frozen-sheet guard. Reading it at render time is what makes it tick.
//
//   prize = principal × ((1 + apy)^(days / 365) − 1)

const DAY = 86400000;

export function accruedInterest(hysa, now = Date.now()) {
  if (!hysa) return null;
  const start = Date.parse(`${hysa.start}T00:00:00Z`);
  const payout = Date.parse(`${hysa.payout}T00:00:00Z`);
  const days = Math.max(0, Math.min(now, payout) - start) / DAY;
  const totalDays = (payout - start) / DAY;
  const at = (elapsed) => hysa.principal * ((1 + hysa.apy) ** (elapsed / 365) - 1);
  return {
    now: at(days),
    atPayout: at(totalDays),
    days: Math.floor(days),
    totalDays: Math.round(totalDays),
    apy: hysa.apy,
    principal: hysa.principal,
    settled: now >= payout,
  };
}

export const money = (amount) =>
  amount.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
