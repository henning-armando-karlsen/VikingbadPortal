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
    <div className="min-h-screen bg-[#F2EFE8] flex items-center justify-center px-4 font-['Inter']">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <svg viewBox="0 0 226.77 226.77" fill="currentColor" aria-hidden="true" className="w-14 h-14 mx-auto mb-4 text-[#252525]">
            <polygon points="132.19 54.15 113.37 37.67 94.58 54.15 113.37 93.5 132.19 54.15" />
            <polygon points="113.39 157.78 74.73 77.07 54.88 77.07 104.06 182.81 104.24 182.81 122.53 182.81 122.71 182.81 171.89 77.07 152.04 77.07 113.39 157.78" />
            <path d="m113.39,0C50.86,0,0,50.86,0,113.39s50.86,113.39,113.39,113.39,113.39-50.86,113.39-113.39S175.91,0,113.39,0Zm0,223.54c-60.74,0-110.15-49.41-110.15-110.15S52.65,3.23,113.39,3.23s110.15,49.41,110.15,110.15-49.41,110.15-110.15,110.15Z" />
          </svg>
          <h1 className="text-2xl font-semibold text-[#252525] tracking-tight font-['Hanken_Grotesk']">Vikingbad Salgsportal</h1>
          <p className="mt-1.5 text-sm text-[#6B6862]">Logg inn for å se salgsdataene</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-[#E4DFD2] shadow-[0_1px_3px_rgba(37,37,37,0.05)] p-6 space-y-4">
          {error && (
            <div className="rounded-lg bg-[#F6EAE7] border border-[#E3C9C2] px-4 py-3 text-sm text-[#B0564A]">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-[#252525] mb-1.5">E-post</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full rounded-lg border border-[#E4DFD2] bg-white px-3 py-2.5 text-sm text-[#252525] placeholder-[#9A968C] focus:outline-none focus:border-[#9D8068] focus:ring-2 focus:ring-[#9D8068]/25 transition-colors"
              placeholder="deg@vikingbad.no"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#252525] mb-1.5">Passord</label>
            <input
              type="password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full rounded-lg border border-[#E4DFD2] bg-white px-3 py-2.5 text-sm text-[#252525] placeholder-[#9A968C] focus:outline-none focus:border-[#9D8068] focus:ring-2 focus:ring-[#9D8068]/25 transition-colors"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-[#252525] hover:bg-[#1a1a1a] disabled:opacity-50 text-white font-medium py-2.5 text-sm tracking-wide transition-colors font-['Hanken_Grotesk']"
          >
            {loading ? 'Logger inn…' : 'Logg inn'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-[#9A968C]">Vikingbad · Salg &amp; innsikt</p>
      </div>
    </div>
  );
}
