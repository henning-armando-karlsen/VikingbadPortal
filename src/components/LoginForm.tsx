import { useState, FormEvent } from 'react';
import { supabase } from '../lib/supabase';

export default function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (err) setError(err.message);
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <svg viewBox="0 0 226.77 226.77" fill="currentColor" aria-hidden="true" className="w-14 h-14 text-[#252525] mb-4">
            <polygon points="132.19 54.15 113.37 37.67 94.58 54.15 113.37 93.5 132.19 54.15" />
            <polygon points="113.39 157.78 74.73 77.07 54.88 77.07 104.06 182.81 104.24 182.81 122.53 182.81 122.71 182.81 171.89 77.07 152.04 77.07 113.39 157.78" />
            <path d="m113.39,0C50.86,0,0,50.86,0,113.39s50.86,113.39,113.39,113.39,113.39-50.86,113.39-113.39S175.91,0,113.39,0Zm0,223.54c-60.74,0-110.15-49.41-110.15-110.15S52.65,3.23,113.39,3.23s110.15,49.41,110.15,110.15-49.41,110.15-110.15,110.15Z" />
          </svg>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Vikingbad Salgsportal</h1>
          <p className="mt-1 text-sm text-gray-500">Logg inn for å se salgsdataene</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">E-post</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="deg@vikingbad.no"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Passord</label>
            <input
              type="password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2.5 text-sm transition-colors"
          >
            {loading ? 'Logger inn…' : 'Logg inn'}
          </button>
        </form>
      </div>
    </div>
  );
}
