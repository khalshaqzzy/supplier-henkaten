import { screen } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/** Opens a shared `Select` and commits the option with the given value, like `selectOptions`. */
export async function chooseOption(user: UserEvent, trigger: HTMLElement, value: string) {
  await user.click(trigger);
  const listbox = await screen.findByRole('listbox');
  const option = [...listbox.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (candidate) => candidate.dataset['value'] === value,
  );
  if (!option) throw new Error(`Option with value "${value}" was not rendered.`);
  await user.click(option);
}
