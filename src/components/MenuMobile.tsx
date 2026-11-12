"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/** Barra superior + fundo escuro para abrir/fechar o menu lateral no celular (≤ 820px). */
export function MenuMobile() {
  const [aberto, setAberto] = useState(false);
  const pathname = usePathname();

  useEffect(() => { setAberto(false); }, [pathname]);
  useEffect(() => {
    document.body.classList.toggle("menu-aberto", aberto);
    return () => document.body.classList.remove("menu-aberto");
  }, [aberto]);

  return (
    <>
      <header className="topbar-mobile">
        <button type="button" className="topbar-botao" aria-label="Abrir menu" aria-expanded={aberto} onClick={() => setAberto(!aberto)}>
          ☰
        </button>
        <span className="topbar-titulo">Painel da Loja</span>
      </header>
      <div className="menu-fundo" onClick={() => setAberto(false)} />
    </>
  );
}
