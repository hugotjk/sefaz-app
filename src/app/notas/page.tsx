import { NotasTable } from "@/components/NotasTable";

export const dynamic = "force-dynamic";

export default function NotasPage() {
  return (
    <div>
      <h1>Notas recebidas</h1>
      <NotasTable />
    </div>
  );
}
