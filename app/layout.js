import "./globals.css";

export const metadata = {
  title: "QuestRock HELOC — Instantly Daily",
  description: "Live Instantly sending, opens, clicks, and campaign recommendations",
  viewport: "width=device-width, initial-scale=1",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
