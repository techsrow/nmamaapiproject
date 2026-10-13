import { prisma } from "../lib/prisma";

interface TaxItem { hsnSac?: string | null; lineTotal: number }
function cents(value: number): number {
    const result = Math.round(value * 100);
    if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(result)) throw new Error("Invalid taxable amount.");
    return result;
}
function normalize(value?: string | null) { return String(value ?? "").trim().toUpperCase(); }
export async function calculateCheckoutTax(input: { country: string; region: string; discount: number; items: TaxItem[] }) {
    const rules = await prisma.taxRule.findMany({ where: { isActive: true }, orderBy: { id: "asc" } });
    const totals = input.items.map((item) => cents(item.lineTotal));
    const subtotal = totals.reduce((sum, value) => sum + value, 0);
    const discount = cents(input.discount);
    if (discount > subtotal) throw new Error("Discount exceeds subtotal.");
    const allocations = totals.map((value, index) => {
        const exact = subtotal ? discount * value / subtotal : 0;
        return { index, amount: Math.floor(exact), remainder: exact - Math.floor(exact) };
    });
    let remaining = discount - allocations.reduce((sum, row) => sum + row.amount, 0);
    for (const row of [...allocations].sort((a, b) => b.remainder - a.remainder || a.index - b.index)) {
        if (remaining <= 0) break;
        row.amount++; remaining--;
    }
    let included = 0, additional = 0;
    const breakdown = input.items.map((item, index) => {
        const base = totals[index] - allocations[index].amount;
        const matches = rules.filter((rule) => normalize(rule.country) === normalize(input.country) && (!normalize(rule.region) || normalize(rule.region) === normalize(input.region)) && (!normalize(rule.hsnSac) || normalize(rule.hsnSac) === normalize(item.hsnSac)));
        const specificity = (rule: typeof rules[number]) => (normalize(rule.hsnSac) ? 2 : 0) + (normalize(rule.region) ? 1 : 0);
        const rank = matches.length ? Math.max(...matches.map(specificity)) : -1;
        const selected = matches.filter((rule) => specificity(rule) === rank);
        if (selected.length !== 1) throw new Error(selected.length ? "Multiple tax rules match an item." : "Tax configuration is missing for an item.");
        const rule = selected[0], rate = Number(rule.rate);
        if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error("Invalid store tax rate.");
        const tax = Math.round(rule.inclusive ? base * rate / (100 + rate) : base * rate / 100);
        if (rule.inclusive) included += tax; else additional += tax;
        return { itemIndex: index, ruleId: rule.id, name: rule.name, rate, inclusive: rule.inclusive, taxableAmount: base / 100, taxAmount: tax / 100 };
    });
    return { tax: (included + additional) / 100, includedTax: included / 100, additionalTax: additional / 100, breakdown };
}
