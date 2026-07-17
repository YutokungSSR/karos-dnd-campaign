export type DiceResult = {
  expression: string;
  total: number;
  detail: string;
};

export function rollDice(rawExpression: string): DiceResult {
  const expression = rawExpression.trim().toLowerCase().replaceAll(" ", "");
  const match = expression.match(/^(\d{1,2})d(\d{1,4})([+-]\d{1,4})?$/);

  if (!match) {
    throw new Error("ใช้รูปแบบ เช่น 1d20, 2d6+3 หรือ 1d100-10");
  }

  const count = Number(match[1]);
  const sides = Number(match[2]);
  const modifier = Number(match[3] ?? 0);

  if (count < 1 || count > 50 || sides < 2 || sides > 1000) {
    throw new Error("จำนวนลูกเต๋าต้อง 1–50 และจำนวนหน้าต้อง 2–1000");
  }

  const rolls = Array.from({ length: count }, () =>
    Math.floor(Math.random() * sides) + 1
  );
  const total = rolls.reduce((sum, value) => sum + value, 0) + modifier;
  const modifierText = modifier === 0 ? "" : modifier > 0 ? ` + ${modifier}` : ` - ${Math.abs(modifier)}`;

  return {
    expression,
    total,
    detail: `[${rolls.join(", ")}]${modifierText}`,
  };
}
