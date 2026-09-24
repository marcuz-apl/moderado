import { discoverSkills } from '../skills.js';

export function handleSkillsCommand(): number {
  const skills = discoverSkills();
  if (!skills.length) {
    process.stdout.write('No valid user skills found in ~/.moderado/skills.\n');
    return 0;
  }
  process.stdout.write(`User skills (${skills.length}):\n`);
  for (const skill of skills) process.stdout.write(`  ${skill.name} — ${skill.description}\n`);
  return 0;
}
