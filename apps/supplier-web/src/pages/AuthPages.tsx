import { zodResolver } from '@hookform/resolvers/zod';
import { KeyRound, LogOut, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { ApiProblemError } from '@tmmin-henkaten/api-client';
import { passwordChangeRequestSchema, supplierLoginRequestSchema } from '@tmmin-henkaten/contracts';
import {
  Alert,
  BrandLockup,
  Button,
  Card,
  Field,
  FormErrorSummary,
  Input,
  KeyValueGrid,
} from '@tmmin-henkaten/ui';

import { consumeIntendedPath, useSession } from '../app/session';
import { PageHeader } from '../components/layout';

type LoginValues = z.input<typeof supplierLoginRequestSchema>;
type PasswordValues = z.input<typeof passwordChangeRequestSchema> & { confirmation: string };

const passwordFormSchema = passwordChangeRequestSchema
  .extend({ confirmation: z.string().min(1, 'Konfirmasi password wajib diisi.') })
  .refine((value) => value.newPassword === value.confirmation, {
    path: ['confirmation'],
    message: 'Konfirmasi password tidak sama.',
  });

export function LoginPage() {
  const { status, session, login } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [problem, setProblem] = useState<string | null>(null);
  const form = useForm<LoginValues>({
    resolver: zodResolver(supplierLoginRequestSchema),
    defaultValues: { supplierCode: '', username: '', password: '' },
  });

  if (status === 'authenticated' && session) {
    return (
      <Navigate to={session.principal.mustChangePassword ? '/change-password' : '/'} replace />
    );
  }

  const submit = form.handleSubmit(async (values) => {
    setProblem(null);
    try {
      const next = await login(values);
      void navigate(
        next.principal.mustChangePassword
          ? '/change-password'
          : ((location.state as { from?: string } | null)?.from ?? consumeIntendedPath()),
        { replace: true },
      );
    } catch (error) {
      setProblem(
        error instanceof ApiProblemError && error.problem.status === 429
          ? `Terlalu banyak percobaan. Coba lagi dalam ${error.retryAfterSeconds ?? 60} detik.`
          : 'Supplier Code, username, atau password tidak valid.',
      );
    }
  });

  return (
    <main className="auth-shell">
      <section className="auth-brand">
        <BrandLockup context="Supplier Portal" />
        <div>
          <span className="product-eyebrow">Enterprise Digital Henkaten</span>
          <p>
            Kelola shift, perubahan 4M, approval, dan assignment.
          </p>
        </div>
      </section>
      <section className="auth-form">
        <div>
          <span className="auth-icon" aria-hidden="true">
            <KeyRound />
          </span>
          <h2>Masuk ke Supplier Portal</h2>
          <p>Gunakan identitas yang diberikan oleh Supplier Admin.</p>
        </div>
        {problem && <FormErrorSummary errors={[{ field: 'login', message: problem }]} />}
        <form onSubmit={(event) => void submit(event)} noValidate>
          <Field
            label="Supplier Code"
            htmlFor="supplier-code"
            errorText={form.formState.errors.supplierCode?.message}
            required
          >
            <Input
              id="supplier-code"
              autoComplete="organization"
              {...form.register('supplierCode')}
            />
          </Field>
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
          <Button type="submit" size="lg" loading={form.formState.isSubmitting}>
            Masuk
          </Button>
        </form>
      </section>
    </main>
  );
}

export function ChangePasswordPage() {
  const { session, changePassword, logout } = useSession();
  const navigate = useNavigate();
  const [problem, setProblem] = useState<string | null>(null);
  const form = useForm<PasswordValues>({
    resolver: zodResolver(passwordFormSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmation: '' },
  });
  const forced = session?.principal.mustChangePassword ?? false;
  const submit = form.handleSubmit(async ({ currentPassword, newPassword }) => {
    setProblem(null);
    try {
      await changePassword({ currentPassword, newPassword });
      void navigate('/login', { replace: true });
    } catch (error) {
      setProblem(
        error instanceof ApiProblemError
          ? error.problem.detail
          : 'Password tidak dapat diubah. Coba lagi.',
      );
    }
  });
  return (
    <main className="auth-compact">
      <Card>
        <BrandLockup context="Supplier Portal" />
        <span className="auth-icon" aria-hidden="true">
          <ShieldCheck />
        </span>
        <h1>{forced ? 'Ganti temporary password' : 'Ganti password'}</h1>
        <p>Password baru harus 12-128 karakter dan tidak boleh sama dengan password sekarang.</p>
        {problem && <FormErrorSummary errors={[{ field: 'password', message: problem }]} />}
        <form onSubmit={(event) => void submit(event)} noValidate>
          <Field
            label="Password sekarang"
            htmlFor="current-password"
            errorText={form.formState.errors.currentPassword?.message}
            required
          >
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              {...form.register('currentPassword')}
            />
          </Field>
          <Field
            label="Password baru"
            htmlFor="new-password"
            errorText={form.formState.errors.newPassword?.message}
            required
          >
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              {...form.register('newPassword')}
            />
          </Field>
          <Field
            label="Konfirmasi password baru"
            htmlFor="confirmation"
            errorText={form.formState.errors.confirmation?.message}
            required
          >
            <Input
              id="confirmation"
              type="password"
              autoComplete="new-password"
              {...form.register('confirmation')}
            />
          </Field>
          <div className="form-actions">
            <Button type="submit" loading={form.formState.isSubmitting}>
              Simpan dan masuk ulang
            </Button>
            <Button variant="ghost" type="button" onClick={() => void logout()}>
              Keluar
            </Button>
          </div>
        </form>
      </Card>
    </main>
  );
}

export function AccountPage() {
  const { session, logout } = useSession();
  const navigate = useNavigate();
  const principal = session!.principal;
  return (
    <div className="product-page">
      <PageHeader
        eyebrow="Identitas dan keamanan"
        title="Akun"
        description="Lihat konteks session aktif dan kelola password Anda."
      />
      <Card className="account-card">
        <KeyValueGrid
          columns={2}
          items={[
            { label: 'Nama', value: principal.displayName },
            { label: 'Role', value: principal.role },
            { label: 'Session purpose', value: principal.purpose },
            {
              label: 'Idle expiry',
              value: new Intl.DateTimeFormat('id-ID', {
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(new Date(session!.idleExpiresAt)),
            },
            {
              label: 'Absolute expiry',
              value: new Intl.DateTimeFormat('id-ID', {
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(new Date(session!.absoluteExpiresAt)),
            },
          ]}
        />
        <Alert tone="info" title="Session aman">
          Credential, CSRF token, dan password tidak disimpan ke persistent browser storage.
        </Alert>
        <div className="form-actions">
          <Button onClick={() => void navigate('/change-password')}>Ganti password</Button>
          <Button
            variant="secondary"
            leadingIcon={<LogOut />}
            onClick={() => void logout().then(() => navigate('/login'))}
          >
            Keluar
          </Button>
        </div>
      </Card>
    </div>
  );
}
