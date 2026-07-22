import { auth } from "@/auth";

export const controllerSession = async () => {
  const session = await auth();
  return session?.user?.role === "controller" || session?.user?.role === "admin" ? session : null;
};

export const adminSession = async () => {
  const session = await auth();
  return session?.user?.role === "admin" ? session : null;
};
