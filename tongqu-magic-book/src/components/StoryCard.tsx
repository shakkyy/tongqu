import { motion } from "framer-motion";
import type { StoryPage } from "../types";

interface StoryCardProps {
  page: StoryPage;
  isActive: boolean;
}

export function StoryCard({ page, isActive }: StoryCardProps) {
  return (
    <motion.article
      className="min-w-[78%] snap-center rounded-3xl bg-white/85 p-4 shadow-soft backdrop-blur"
      animate={{ scale: isActive ? 1 : 0.96, opacity: isActive ? 1 : 0.72 }}
      transition={{ duration: 0.35 }}
    >
      <div className="grid grid-cols-[1.1fr_1fr] gap-4">
        <img
          src={page.imageUrl}
          alt={page.title}
          className="h-64 w-full rounded-2xl object-cover"
        />
        <div className="flex flex-col rounded-2xl bg-gradient-to-br from-yellow-kid/30 to-mint-kid/20 p-4">
          <h3 className="mb-3 text-2xl font-bold text-slate-800">{page.title}</h3>
          <p className="text-lg leading-relaxed text-slate-700">{page.text}</p>
        </div>
      </div>
    </motion.article>
  );
}
