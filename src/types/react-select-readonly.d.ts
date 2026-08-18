import "react";

declare module "react" {
  interface SelectHTMLAttributes<T> {
    readOnly?: boolean;
  }
}
