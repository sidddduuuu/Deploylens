"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

export function Reveal({
  children,
  className,
  delay = 0,
}: Readonly<{
  children: ReactNode;
  className?: string;
  delay?: number;
}>) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={false}
      transition={{ delay, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      viewport={{ once: true, amount: 0.2 }}
      whileInView={{ y: reduceMotion ? 0 : [12, 0] }}
    >
      {children}
    </motion.div>
  );
}

export function HeroMotion({ children }: Readonly<{ children: ReactNode }>) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      animate={{ y: reduceMotion ? 0 : [10, 0] }}
      initial={false}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
