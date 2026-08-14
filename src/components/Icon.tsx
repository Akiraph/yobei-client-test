
import {
  Search,
  Copy,
  Check,
  Eye,
  EyeOff,
  Plus,
  RefreshCw,
  FileText,
  LayoutGrid,
  Lock,
  Settings,
  Fingerprint,
  ChevronDown,
  ChevronLeft,
  Minus,
  Maximize2,
  Minimize2,
  X,
  Pencil,
  Trash2,
  Shield,
  Globe,
  ScanLine,
  Upload,
  Download,
  type LucideProps,
} from 'lucide-solid';

const dp = (p: LucideProps) => ({ size: p.size ?? 16, strokeWidth: 1.8, ...p });

export const IconSearch = (p: LucideProps) => <Search {...dp(p)} />;
export const IconCopy = (p: LucideProps) => <Copy {...dp(p)} />;
export const IconCheck = (p: LucideProps) => <Check {...dp(p)} />;
export const IconEye = (p: LucideProps) => <Eye {...dp(p)} />;
export const IconEyeOff = (p: LucideProps) => <EyeOff {...dp(p)} />;
export const IconPlus = (p: LucideProps) => <Plus {...dp(p)} />;
export const IconRefresh = (p: LucideProps) => <RefreshCw {...dp(p)} />;
export const IconNote = (p: LucideProps) => <FileText {...dp(p)} />;
export const IconGrid = (p: LucideProps) => <LayoutGrid {...dp(p)} />;
export const IconLock = (p: LucideProps) => <Lock {...dp(p)} />;
export const IconSettings = (p: LucideProps) => <Settings {...dp(p)} />;
export const IconFingerprint = (p: LucideProps) => <Fingerprint {...dp(p)} />;
export const IconChevronDown = (p: LucideProps) => <ChevronDown {...dp(p)} />;
export const IconBack = (p: LucideProps) => <ChevronLeft {...dp(p)} />;
export const IconMinus = (p: LucideProps) => <Minus {...dp(p)} />;
export const IconMaximize = (p: LucideProps) => <Maximize2 {...dp(p)} />;
export const IconRestore = (p: LucideProps) => <Minimize2 {...dp(p)} />;
export const IconX = (p: LucideProps) => <X {...dp(p)} />;
export const IconPencil = (p: LucideProps) => <Pencil {...dp(p)} />;
export const IconTrash = (p: LucideProps) => <Trash2 {...dp(p)} />;
export const IconShield = (p: LucideProps) => <Shield {...dp(p)} />;
export const IconBrowser = (p: LucideProps) => <Globe {...dp(p)} />;
export const IconScan = (p: LucideProps) => <ScanLine {...dp(p)} />;
export const IconUpload = (p: LucideProps) => <Upload {...dp(p)} />;
export const IconDownload = (p: LucideProps) => <Download {...dp(p)} />;
