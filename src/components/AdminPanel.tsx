import { useState, useEffect, Fragment } from 'react';
import { supabase } from '../lib/supabase';

type User = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  ra: string | null;
  aktiv: boolean;
  created_at: string;
};

type RoleOption = { role_key: string; label: string };

type RowEdit = {
  full_name: string;
  role: string;
  ra: string;
  pw: string;
  showPw: boolean;
  saving: boolean;
  rowError: string | null;
};

type Props = { onClose: () => void };

async function callAdmin(action: string, payload: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke('admin-users', { body: { action, payload } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export default function AdminPanel({ onClose }: Props) {
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rowEdits, setRowEdits] = useState<Record<string, RowEdit>>({});
  const [newUser, setNewUser] = useState({ email: '', full_name: '', password: '', role: '', ra: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [{ data: rolesData }, listData] = await Promise.all([
        supabase.from('app_roles').select('role_key,label').order('label'),
        callAdmin('list'),
      ]);
      const r = (rolesData ?? []) as RoleOption[];
      const u = (listData.users ?? []) as User[];
      setRoles(r);
      setUsers(u);
      const edits: Record<string, RowEdit> = {};
      for (const user of u) {
        edits[user.id] = {
          full_name: user.full_name ?? '',
          role: user.role,
          ra: user.ra ?? '',
          pw: '',
          showPw: false,
          saving: false,
          rowError: null,
        };
      }
      setRowEdits(edits);
      setNewUser(p => ({ ...p, role: p.role || r[0]?.role_key || '' }));
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  function patchRow(id: string, patch: Partial<RowEdit>) {
    setRowEdits(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function handleSave(user: User) {
    const edit = rowEdits[user.id];
    patchRow(user.id, { saving: true, rowError: null });
    try {
      await callAdmin('update', {
        id: user.id,
        role: edit.role,
        ra: edit.ra || null,
        full_name: edit.full_name,
      });
      setUsers(prev => prev.map(u =>
        u.id === user.id ? { ...u, role: edit.role, ra: edit.ra || null, full_name: edit.full_name } : u
      ));
    } catch (e: any) {
      patchRow(user.id, { rowError: e.message ?? String(e) });
    } finally {
      patchRow(user.id, { saving: false });
    }
  }

  async function handleSetPassword(user: User) {
    const edit = rowEdits[user.id];
    if (!edit.pw) return;
    patchRow(user.id, { saving: true, rowError: null });
    try {
      await callAdmin('set_password', { id: user.id, password: edit.pw });
      patchRow(user.id, { pw: '', showPw: false });
    } catch (e: any) {
      patchRow(user.id, { rowError: e.message ?? String(e) });
    } finally {
      patchRow(user.id, { saving: false });
    }
  }

  async function handleSetActive(user: User, aktiv: boolean) {
    patchRow(user.id, { saving: true, rowError: null });
    try {
      await callAdmin('set_active', { id: user.id, aktiv });
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, aktiv } : u));
    } catch (e: any) {
      patchRow(user.id, { rowError: e.message ?? String(e) });
    } finally {
      patchRow(user.id, { saving: false });
    }
  }

  async function handleCreate() {
    if (!newUser.email || !newUser.password) {
      setCreateError('E-post og passord er påkrevd.');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await callAdmin('create', {
        email: newUser.email,
        password: newUser.password,
        full_name: newUser.full_name || null,
        role: newUser.role || null,
        ra: newUser.ra || null,
      });
      setNewUser(p => ({ email: '', full_name: '', password: '', role: p.role, ra: '' }));
      await load();
    } catch (e: any) {
      setCreateError(e.message ?? String(e));
    } finally {
      setCreating(false);
    }
  }

  const inputCls =
    'border border-gray-200 rounded-lg text-sm px-2.5 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400';
  const btnSm =
    'inline-flex items-center rounded-lg text-xs font-medium px-3 py-1.5 transition-colors disabled:opacity-50';

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 backdrop-blur-sm">
      <div className="min-h-screen flex items-start justify-center p-4 pt-8 pb-16">
        <div className="w-full max-w-5xl bg-white rounded-2xl shadow-xl">

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Brukeradministrasjon</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="px-6 py-6 space-y-6">

            {/* Ny bruker */}
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Ny bruker</h3>
              {createError && (
                <div className="mb-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {createError}
                </div>
              )}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
                <input
                  className={inputCls}
                  placeholder="E-post *"
                  value={newUser.email}
                  onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))}
                />
                <input
                  className={inputCls}
                  placeholder="Fullt navn"
                  value={newUser.full_name}
                  onChange={e => setNewUser(p => ({ ...p, full_name: e.target.value }))}
                />
                <input
                  className={inputCls}
                  placeholder="Passord *"
                  type="password"
                  value={newUser.password}
                  onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))}
                />
                <select
                  className={inputCls}
                  value={newUser.role}
                  onChange={e => setNewUser(p => ({ ...p, role: e.target.value }))}
                >
                  {roles.map(r => (
                    <option key={r.role_key} value={r.role_key}>{r.label}</option>
                  ))}
                </select>
                <input
                  className={inputCls}
                  placeholder="RA (region)"
                  value={newUser.ra}
                  onChange={e => setNewUser(p => ({ ...p, ra: e.target.value }))}
                />
                <button
                  onClick={handleCreate}
                  disabled={creating}
                  className={`${btnSm} bg-blue-600 hover:bg-blue-700 text-white justify-center`}
                >
                  {creating ? 'Oppretter…' : 'Opprett bruker'}
                </button>
              </div>
            </div>

            {/* Global feilmelding */}
            {error && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                {error}
              </div>
            )}

            {/* Brukerliste */}
            {loading ? (
              <div className="flex justify-center py-10">
                <div className="w-8 h-8 rounded-full border-4 border-blue-100 border-t-blue-600 animate-spin" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-medium text-gray-500 border-b border-gray-100">
                      <th className="pb-2 pr-3 font-medium">Navn</th>
                      <th className="pb-2 pr-3 font-medium">E-post</th>
                      <th className="pb-2 pr-3 font-medium">Rolle</th>
                      <th className="pb-2 pr-3 font-medium">RA</th>
                      <th className="pb-2 pr-3 font-medium">Aktiv</th>
                      <th className="pb-2 pr-3 font-medium">Opprettet</th>
                      <th className="pb-2 font-medium">Handlinger</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(user => {
                      const edit = rowEdits[user.id];
                      if (!edit) return null;
                      return (
                        <Fragment key={user.id}>
                          <tr className="border-b border-gray-50 hover:bg-gray-50/50">
                            <td className="py-2 pr-3">
                              <input
                                className={inputCls}
                                value={edit.full_name}
                                onChange={e => patchRow(user.id, { full_name: e.target.value })}
                              />
                            </td>
                            <td className="py-2 pr-3 text-gray-500 whitespace-nowrap text-xs">
                              {user.email}
                            </td>
                            <td className="py-2 pr-3">
                              <select
                                className={inputCls}
                                value={edit.role}
                                onChange={e => patchRow(user.id, { role: e.target.value })}
                              >
                                {roles.map(r => (
                                  <option key={r.role_key} value={r.role_key}>{r.label}</option>
                                ))}
                              </select>
                            </td>
                            <td className="py-2 pr-3">
                              <input
                                className={inputCls}
                                value={edit.ra}
                                placeholder="–"
                                onChange={e => patchRow(user.id, { ra: e.target.value })}
                              />
                            </td>
                            <td className="py-2 pr-3">
                              <button
                                onClick={() => handleSetActive(user, !user.aktiv)}
                                disabled={edit.saving}
                                className={`${btnSm} ${
                                  user.aktiv
                                    ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                                }`}
                              >
                                {user.aktiv ? 'Ja' : 'Nei'}
                              </button>
                            </td>
                            <td className="py-2 pr-3 text-xs text-gray-400 whitespace-nowrap">
                              {new Date(user.created_at).toLocaleDateString('nb')}
                            </td>
                            <td className="py-2">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <button
                                  onClick={() => handleSave(user)}
                                  disabled={edit.saving}
                                  className={`${btnSm} bg-gray-100 hover:bg-gray-200 text-gray-700`}
                                >
                                  {edit.saving ? 'Lagrer…' : 'Lagre'}
                                </button>
                                <button
                                  onClick={() => patchRow(user.id, { showPw: !edit.showPw })}
                                  className={`${btnSm} border border-gray-200 hover:bg-gray-50 text-gray-600`}
                                >
                                  Sett passord
                                </button>
                              </div>
                            </td>
                          </tr>

                          {edit.showPw && (
                            <tr className="bg-gray-50/70">
                              <td colSpan={7} className="px-2 pb-3 pt-1">
                                <div className="flex items-center gap-2">
                                  <input
                                    type="password"
                                    className={`${inputCls} max-w-xs`}
                                    placeholder="Nytt passord"
                                    value={edit.pw}
                                    onChange={e => patchRow(user.id, { pw: e.target.value })}
                                  />
                                  <button
                                    onClick={() => handleSetPassword(user)}
                                    disabled={edit.saving || !edit.pw}
                                    className={`${btnSm} bg-blue-600 hover:bg-blue-700 text-white`}
                                  >
                                    Bekreft
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )}

                          {edit.rowError && (
                            <tr>
                              <td colSpan={7} className="pb-2 px-1">
                                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
                                  {edit.rowError}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>

                {users.length === 0 && (
                  <p className="text-center text-sm text-gray-400 py-10">Ingen brukere funnet.</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
