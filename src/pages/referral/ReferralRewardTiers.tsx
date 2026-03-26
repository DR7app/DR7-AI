export default function ReferralRewardTiers() {
  return (
    <div className="space-y-4">
      <h3 className="text-xl font-bold text-white text-center mb-6">Come Funziona</h3>

      {/* Registration bonus */}
      <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-[#2d8a7e]/20 rounded-xl flex items-center justify-center flex-shrink-0">
            <span className="text-2xl">🎁</span>
          </div>
          <div>
            <h4 className="text-white font-semibold text-lg">Registrati Gratis</h4>
            <p className="text-gray-400 text-sm mt-1">
              Ricevi subito <span className="text-[#2d8a7e] font-bold">€15</span> di credito Wallet
              + un <span className="text-[#2d8a7e] font-bold">Buono da €50</span> per noleggio supercar
            </p>
          </div>
        </div>
      </div>

      {/* Friend topup bonus */}
      <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-[#2d8a7e]/20 rounded-xl flex items-center justify-center flex-shrink-0">
            <span className="text-2xl">💳</span>
          </div>
          <div>
            <h4 className="text-white font-semibold text-lg">Invita Amici che Ricaricano</h4>
            <p className="text-gray-400 text-sm mt-1">
              Per ogni amico che ricarica almeno €100, ricevi
              <span className="text-[#2d8a7e] font-bold"> €50</span> di credito Wallet
              + un <span className="text-[#2d8a7e] font-bold">Buono da €100</span> per noleggio supercar
            </p>
          </div>
        </div>
      </div>

      {/* Milestone bonus */}
      <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-[#2d8a7e]/20 rounded-xl flex items-center justify-center flex-shrink-0">
            <span className="text-2xl">🔁</span>
          </div>
          <div>
            <h4 className="text-white font-semibold text-lg">Ogni 10 Amici</h4>
            <p className="text-gray-400 text-sm mt-1">
              Ogni 10 amici che inviti e ricaricano, ricevi un bonus extra di
              <span className="text-[#2d8a7e] font-bold"> €50</span> Wallet
              + <span className="text-[#2d8a7e] font-bold">Buono da €500</span> per noleggio supercar
            </p>
          </div>
        </div>
      </div>

      {/* No limits */}
      <div className="bg-gradient-to-r from-[#2d8a7e]/10 to-transparent border border-[#2d8a7e]/30 rounded-2xl p-5">
        <div className="flex items-center gap-3">
          <span className="text-2xl">♾️</span>
          <p className="text-[#2d8a7e] font-semibold">Nessun limite! Piu inviti, piu guadagni.</p>
        </div>
      </div>
    </div>
  )
}
