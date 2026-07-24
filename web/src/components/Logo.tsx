import logo from "@/assets/logo.png";
import { cn } from "@/lib/utils";

type LogoMarkProps = {
  className?: string;
};

export function LogoMark({ className }: LogoMarkProps) {
  return (
    <img
      src={logo}
      alt="Remifi"
      className={cn("rounded-lg object-contain", className)}
    />
  );
}
