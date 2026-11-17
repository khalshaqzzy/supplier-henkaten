import { useState, type FormEvent, type ReactElement } from 'react';

import { Dialog } from './advanced';
import { Alert, Button, Field, Input } from './primitives';

export interface UsernameDialogProps {
  trigger: ReactElement;
  /** Display name of the account owner, shown as the dialog eyebrow. */
  owner: string;
  username: string;
  /** Saves the new username; a rejected promise keeps the dialog open with its message. */
  onSubmit: (username: string) => Promise<void>;
  /** Maps a rejected save to the message shown in the dialog. */
  describeError?: (error: unknown) => string;
}

const MAX_USERNAME_LENGTH = 100;

/** Admin rename of one account. The password and active sessions are kept. */
export function UsernameDialog({
  trigger,
  owner,
  username,
  onSubmit,
  describeError = () => 'Username tidak dapat diubah.',
}: UsernameDialogProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(username);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const next = value.trim();
  const unchanged = next === username.trim();
  const invalid = !next || next.length > MAX_USERNAME_LENGTH;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (invalid || unchanged || saving) return;
    setSaving(true);
    setProblem(null);
    try {
      await onSubmit(next);
      setOpen(false);
    } catch (error) {
      setProblem(describeError(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      trigger={trigger}
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          setValue(username);
          setProblem(null);
        }
      }}
      eyebrow={owner}
      title="Ubah username"
      size="sm"
    >
      <form className="hds-username-dialog" onSubmit={(event) => void submit(event)}>
        {problem && (
          <Alert tone="danger" title="Username tidak dapat diubah">
            {problem}
          </Alert>
        )}
        <Field
          label="Username baru"
          htmlFor="username-dialog-input"
          required
          {...(next.length > MAX_USERNAME_LENGTH
            ? { errorText: `Maksimal ${MAX_USERNAME_LENGTH} karakter.` }
            : {})}
        >
          <Input
            id="username-dialog-input"
            value={value}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={MAX_USERNAME_LENGTH + 20}
            onChange={(event) => setValue(event.target.value)}
          />
        </Field>
        <div className="hds-username-dialog__actions">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Batal
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={invalid || unchanged}>
            Simpan username
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
