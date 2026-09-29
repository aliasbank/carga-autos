import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Carga en orden",
  description: "Turnos claros para cargar vehículos eléctricos en el trabajo.",
  // Relative paths remain inside the configured basePath when Nginx mounts
  // the app at /cargadores/.
  icons: { icon: "favicon.svg", shortcut: "favicon.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
