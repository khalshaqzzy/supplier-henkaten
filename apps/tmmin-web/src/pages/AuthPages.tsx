import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { ApiProblemError } from '@tmmin-henkaten/api-client';
import {
  BrandLockup,
  Button,
  Card,
  Field,
  FourMLegend,
  Input,
  KeyValueGrid,
} from '@tmmin-henkaten/ui';

import { consumeIntendedPath, useTmminSession } from '../app/session';
import { PageHeader } from '../components/layout';

const loginSchema = z.object({
  username: z.string().trim().min(1, 'Username wajib diisi.'),
  password: z.string().min(1, 'Password wajib diisi.'),
});

export function LoginPage() {
  const { login } = useTmminSession();
  const navigate = useNavigate();
  const [problem, setProblem] = useState('');
  const form = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema) });
  return (
    <main className="tmmin-auth">
      <section>
        <BrandLockup context="TMMIN Portal" />
        <div>
          <span className="tmmin-eyebrow">Enterprise Digital Henkaten</span>
          <FourMLegend />
        </div>
        <small>Akses internal TMMIN</small>
      </section>
      <Card>
        <span className="tmmin-eyebrow">Akses aman</span>
        <h1>Masuk ke TMMIN Portal</h1>
        <p>Gunakan identitas internal TMMIN.</p>
        {problem && (
          <div className="tmmin-error" role="alert">
            {problem}
          </div>
        )}
        <form
          onSubmit={(event) =>
            void form.handleSubmit(async (values) => {
              setProblem('');
              try {
                const session = await login(values);
                void navigate(
                  session.principal.mustChangePassword ? '/change-password' : consumeIntendedPath(),
                  { replace: true },
                );
              } catch (error) {
                setProblem(
                  error instanceof ApiProblemError && error.problem.status === 429
                    ? `Terlalu banyak percobaan. Coba lagi dalam ${error.retryAfterSeconds ?? 60} detik.`
                    : 'Username atau password tidak valid.',
                );
              }
            })(event)
          }
        >
          <Field
            label="Username"
            htmlFor="username"
            errorText={form.formState.errors.username?.message}
            required
          >
            <Input id="username" autoComplete="username" {...form.register('username')} />
          </Field>
          <Field
            label="Password"
            htmlFor="password"
            errorText={form.formState.errors.password?.message}
            required
          >
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              {...form.register('password')}
            />
          </Field>
          <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
            Masuk
          </Button>
        </form>
      </Card>
    </main>
  );
}

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(12, 'Gunakan minimal 12 karakter.'),
    confirmation: z.string(),
  })
  .refine((value) => value.newPassword === value.confirmation, {
    path: ['confirmation'],
    message: 'Konfirmasi password tidak sama.',
  });

export function ChangePasswordPage() {
  const { session, changePassword, logout } = useTmminSession();
  const [problem, setProblem] = useState('');
  const form = useForm<z.infer<typeof passwordSchema>>({ resolver: zodResolver(passwordSchema) });
  return (
    <main className="tmmin-compact">
      <Card>
        <BrandLockup context="TMMIN Portal" />
        <h1>
          {session?.principal.mustChangePassword ? 'Ganti temporary password' : 'Ganti password'}
        </h1>
        <p>Password baru akan mengakhiri session ini dan meminta login ulang.</p>
        {problem && (
          <div className="tmmin-error" role="alert">
            {problem}
          </div>
        )}
        <form
          onSubmit={(event) =>
            void form.handleSubmit(async ({ confirmation: _, ...values }) => {
              try {
                await changePassword(values);
              } catch {
                setProblem('Password tidak dapat diubah.');
              }
            })(event)
          }
        >
          <Field
            label="Password sekarang"
            errorText={form.formState.errors.currentPassword?.message}
          >
            <Input
              type="password"
              autoComplete="current-password"
              {...form.register('currentPassword')}
            />
          </Field>
          <Field label="Password baru" errorText={form.formState.errors.newPassword?.message}>
            <Input type="password" autoComplete="new-password" {...form.register('newPassword')} />
          </Field>
          <Field label="Konfirmasi" errorText={form.formState.errors.confirmation?.message}>
            <Input type="password" autoComplete="new-password" {...form.register('confirmation')} />
          </Field>
          <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
            Simpan dan masuk ulang
          </Button>
          <Button variant="ghost" onClick={() => void logout()}>
            Keluar
          </Button>
        </form>
      </Card>
    </main>
  );
}

export function AccountPage() {
  const { session, logout } = useTmminSession();
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        eyebrow="Identitas dan session"
        title="Akun"
        description="Tinjau identitas dan batas waktu session aktif."
      />
      <Card className="tmmin-detail-card">
        <KeyValueGrid
          columns={2}
          items={[
            { label: 'Nama', value: session!.principal.displayName },
            {
              label: 'Role',
              value: session!.principal.role === 'TMMIN_ADMIN' ? 'TMMIN Admin' : 'TMMIN Quality',
            },
            {
              label: 'Idle expiry',
              value: new Date(session!.idleExpiresAt).toLocaleString('id-ID'),
            },
            {
              label: 'Absolute expiry',
              value: new Date(session!.absoluteExpiresAt).toLocaleString('id-ID'),
            },
          ]}
        />
        <div className="tmmin-actions">
          <Button onClick={() => void navigate('/change-password')}>Ganti password</Button>
          <Button variant="danger" onClick={() => void logout()}>
            Keluar
          </Button>
        </div>
      </Card>
    </>
  );
}
