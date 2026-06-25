'use client';

export function Footer() {
  return (
    <footer className="mt-auto border-t border-white/5">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          {/* Logo */}
          <div>
            <span className="text-lg font-bold text-[#e50914]">
              StreamVault
            </span>
          </div>

          {/* Links */}
          <div className="flex flex-wrap items-center justify-center gap-4 md:gap-6 text-sm text-gray-500">
            <a href="#" className="hover:text-gray-300 transition-colors">
              Términos de Uso
            </a>
            <a href="#" className="hover:text-gray-300 transition-colors">
              Privacidad
            </a>
            <a href="#" className="hover:text-gray-300 transition-colors">
              Centro de Ayuda
            </a>
            <a href="#" className="hover:text-gray-300 transition-colors">
              Contacto
            </a>
          </div>

          {/* Copyright */}
          <div className="text-sm text-gray-600">
            © {new Date().getFullYear()} StreamVault
          </div>
        </div>
      </div>
    </footer>
  );
}
