import { discoverSkills, formatSkillsList, getEnabledSkillNames, setSkillEnabled } from '../skills.js';

export function handleSkillsCommand(action?: 'on' | 'off', name?: string): number {
  if (action && !name) {
    process.stderr.write(`Usage: moderado skills ${action} NAME\n`);
    return 1;
  }
  if (action && name) {
    try { setSkillEnabled(name, action === 'on'); }
    catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); return 1; }
    process.stdout.write(`User skill ${name} ${action === 'on' ? 'enabled' : 'disabled'}.\n`);
    return 0;
  }
  const skills = discoverSkills();
  if (name) {
    const skill = skills.find((item) => item.name === name);
    if (!skill) { process.stderr.write(`Unknown skill: ${name}\n`); return 1; }
    process.stdout.write(`${skill.name} — ${skill.description}\nSource: ${skill.path}\n`);
    return 0;
  }
  process.stdout.write(`${formatSkillsList(skills, false, undefined, getEnabledSkillNames())}\n`);
  return 0;
}
