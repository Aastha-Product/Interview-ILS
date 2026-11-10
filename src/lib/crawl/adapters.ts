import "server-only";

import type { BoardSystem } from "@/generated/prisma/enums";

import { ashby } from "./ashby";
import { greenhouse } from "./greenhouse";
import { lever } from "./lever";
import { smartrecruiters } from "./smartrecruiters";
import type { BoardAdapter } from "./types";

export const ADAPTERS: Record<BoardSystem, BoardAdapter> = {
  GREENHOUSE: greenhouse,
  LEVER: lever,
  ASHBY: ashby,
  SMARTRECRUITERS: smartrecruiters,
};
