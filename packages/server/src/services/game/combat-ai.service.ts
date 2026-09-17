import { chooseCombatCandidate, combatAiHash, type CombatAiCandidate } from "@marinara-engine/shared";
import type { CombatantStats, PlayerAction } from "./combat.service.js";

export function chooseClassicAction(
  unit: CombatantStats,
  allies: CombatantStats[],
  enemies: CombatantStats[],
  round: number,
): PlayerAction {
  if (!enemies.length) return { type: "defend" };
  if (!unit.tactics) return { type: "attack", targetId: enemies[0]!.id };
  if (unit.tactics!.adjective === "mindless") {
    const target = enemies
      .slice()
      .sort(
        (a, b) =>
          combatAiHash(`${unit.tactics!.seed}:${a.id}`) - combatAiHash(`${unit.tactics!.seed}:${b.id}`) ||
          a.id.localeCompare(b.id),
      )[0]!;
    return { type: "attack", targetId: target.id };
  }
  const candidates: CombatAiCandidate<PlayerAction>[] = [];
  const protectee = allies.filter((a) => a.id !== unit.id).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
  for (const target of enemies) {
    for (const skill of [
      undefined,
      ...(unit.skills ?? []).filter(
        (s) =>
          !s.reaction &&
          s.type === "attack" &&
          (s.slotLevel ? (unit.spellSlots?.[String(s.slotLevel)] ?? 0) > 0 : (unit.mp ?? 0) >= s.mpCost) &&
          (unit.skillCooldowns?.[s.id] ?? 0) <= 0,
      ),
    ]) {
      // Estimate uses current public stats; it never rolls dice or reads player orders.
      const damage = Math.max(
        1,
        unit.attack * Math.max(1, skill?.power ?? 1) * (1 + unit.level * 0.1) +
          Math.max(1, Math.floor(unit.level / 2)) * 3.5 -
          target.defense * 0.4,
      );
      candidates.push({
        action: skill
          ? { type: "skill", skillId: skill.id, targetId: target.id }
          : { type: "attack", targetId: target.id },
        targetId: target.id,
        damage:
          skill?.targetScope === "all-enemies"
            ? enemies.reduce(
                (sum, foe) => sum + Math.max(1, damage + (target.defense - foe.defense) * 0.4) / Math.max(1, foe.maxHp),
                0,
              )
            : damage / Math.max(1, target.maxHp),
        finish: damage >= target.hp ? 0.7 : 0,
        cost: skill?.slotLevel
          ? 1 / Math.max(1, unit.spellSlots?.[String(skill.slotLevel)] ?? 0)
          : (skill?.mpCost ?? 0) / Math.max(1, unit.maxMp ?? unit.mp ?? 0),
        protection: protectee && target.tactics?.targetId === protectee.id ? 0.6 : 0,
        coordination: allies.some((a) => a.id !== unit.id && a.tactics?.targetId === target.id) ? 0.5 : 0,
      });
    }
  }
  for (const skill of (unit.skills ?? []).filter(
    (s) =>
      !s.reaction &&
      s.type !== "attack" &&
      (s.slotLevel ? (unit.spellSlots?.[String(s.slotLevel)] ?? 0) > 0 : (unit.mp ?? 0) >= s.mpCost) &&
      (unit.skillCooldowns?.[s.id] ?? 0) <= 0,
  )) {
    for (const target of skill.type === "debuff" ? enemies : allies) {
      const active = target.statusEffects?.some(
        (s) => s.name === (skill.statusEffect || skill.name) && s.turnsLeft > 1,
      );
      const healing =
        skill.type === "heal"
          ? Math.min(
              target.maxHp - target.hp,
              Math.floor((unit.attack + unit.level * 2) * Math.max(skill.power, 0.5)),
            ) / Math.max(1, target.maxHp)
          : 0;
      if (skill.type === "heal" ? healing <= 0 : active) continue;
      candidates.push({
        action: { type: "skill", skillId: skill.id, targetId: target.id },
        targetId: skill.type === "debuff" ? target.id : undefined,
        healing: healing * (target.hp / target.maxHp < 0.4 ? 2 : 1),
        support: skill.type === "buff" ? 0.5 : 0,
        setup: skill.type === "debuff" ? 0.6 : 0,
        coordination: skill.type === "debuff" && allies.some((a) => a.id !== unit.id && a.hp > 0) ? 0.4 : 0,
        protection: target.id === protectee?.id ? 0.6 : 0,
        cost: skill.slotLevel
          ? 1 / Math.max(1, unit.spellSlots?.[String(skill.slotLevel)] ?? 0)
          : skill.mpCost / Math.max(1, unit.maxMp ?? unit.mp ?? 0),
      });
    }
  }
  if (
    (unit.tactics!.holds ?? 0) < 1 &&
    (unit.tactics!.adjective !== "patient" || Object.values(unit.skillCooldowns ?? {}).some((cd) => cd === 1))
  )
    candidates.push({ action: { type: "defend" }, hold: true });
  return chooseCombatCandidate(unit, candidates, round);
}
