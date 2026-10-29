import type { AnswerDetail } from '@moderado/core';

const TONE_DESCRIPTION: Record<AnswerDetail, string> = {
  concise: 'concise (default): short, direct answers',
  expanded: 'expanded: full reasoning, structure, and explanations',
};

export function parseDetailCommand(input: string, current: AnswerDetail): { detail: AnswerDetail; message: string } {
  const value = input.slice('/detail'.length).trim().toLowerCase();
  let detail: AnswerDetail | undefined;
  if (!value) detail = current === 'concise' ? 'expanded' : 'concise';
  else if (value === 'concise' || value === 'expanded') detail = value;
  if (!detail) {
    return { detail: current, message: `Answers stay ${TONE_DESCRIPTION[current]}. Usage: /detail [concise|expanded].` };
  }
  return { detail, message: `Answers will be ${TONE_DESCRIPTION[detail]}. Type /detail to switch.` };
}
