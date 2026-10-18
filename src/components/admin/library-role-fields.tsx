'use client';

import { LIBRARY_ROLES, roleLabel, type LibraryRole } from '@/lib/library/taxonomy';

/** Casillas de rol de una imagen (puede tener varios o ninguno). */
export function RoleChecks({ value, onChange, label = 'Para qué sirve' }: { value: LibraryRole[]; onChange: (roles: LibraryRole[]) => void; label?: string }) {
  const toggle = (id: LibraryRole) => onChange(LIBRARY_ROLES.map((r) => r.id).filter((r) => (r === id ? !value.includes(r) : value.includes(r))));
  return (
    <fieldset className="text-sm font-semibold" data-testid="role-checks">
      <legend>{label}</legend>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {LIBRARY_ROLES.map((r) => (
          <label key={r.id} className="flex min-h-9 cursor-pointer items-center gap-2 font-normal" title={r.hint}>
            <input type="checkbox" className="size-4 accent-[#fbbf24]" checked={value.includes(r.id)} onChange={() => toggle(r.id)} aria-label={`Rol: ${r.label}`} />
            {r.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Etiquetas pequeñas con los roles de una imagen. */
export function RoleBadges({ roles }: { roles: LibraryRole[] }) {
  if (roles.length === 0) return <span className="rounded-full bg-rose/20 px-1.5 py-0.5 text-[10px] font-bold text-rose">sin rol</span>;
  return <>{roles.map((r) => <span key={r} className="rounded-full bg-violet/25 px-1.5 py-0.5 text-[10px] font-bold text-violet-soft">{roleLabel(r)}</span>)}</>;
}
