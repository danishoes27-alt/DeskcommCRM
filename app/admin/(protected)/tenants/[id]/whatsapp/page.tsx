import { TenantWhatsappClient } from "./_client";

interface TenantWhatsappPageProps {
  params: Promise<{ id: string }>;
}

export default async function TenantWhatsappPage({ params }: TenantWhatsappPageProps) {
  const { id } = await params;
  return <TenantWhatsappClient id={id} />;
}
