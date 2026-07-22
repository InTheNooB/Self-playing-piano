import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AdminDashboard } from "@/components/admin-dashboard";

const AdminPage = async () => {
  const session = await auth();
  if (!session) redirect("/login");
  return <AdminDashboard />;
};

export default AdminPage;
