export interface CartItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
}

export interface CustomerData {
  name: string;
  phone: string;
  address: string;
  reference?: string;
}

export interface AgentResponse {
  message: string;
  type?: 'text' | 'menu' | 'summary' | 'payment' | 'status' | 'survey';
  data?: any;
  quickReplies?: string[];
  orderId?: string;
}

export interface ChatSession {
  sessionId: string;
  chatState: ChatState;
  orderId?: string;
  customerName?: string;
  customerPhone?: string;
  deliveryAddress?: string;
  deliveryReference?: string;
  cart: CartItem[];
  lastActivity: Date;
  waitingForProof?: boolean;
}

export type ChatState =
  | 'GREETING'
  | 'COLLECTING_NAME'
  | 'MENU'
  | 'SELECTING'
  | 'COLLECTING_PHONE'
  | 'COLLECTING_ADDRESS'
  | 'COLLECTING_REFERENCE'
  | 'CONFIRMING_ORDER'
  | 'PAYMENT_INSTRUCTIONS'
  | 'WAITING_PROOF'
  | 'AWAITING_VALIDATION'
  | 'ORDER_ACTIVE'
  | 'SURVEY';

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
}

export interface ParsedProduct {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
}

export interface OrderCreateInput {
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  deliveryReference?: string;
  cart: CartItem[];
}

export interface AdminMetrics {
  totalOrders: number;
  pendingOrders: number;
  deliveredOrders: number;
  estimatedRevenue: number;
  ordersToday: number;
}

export interface ValidationResult {
  isValid: boolean;
  confidence: number;
  detectedAmount: number | null;
  detectedMethod: 'YAPE' | 'PLIN' | 'UNKNOWN';
  detectedReceiverNumber: string | null;
  rejectionReason: string | null;
  validationDetails: {
    amountMatches: boolean;
    receiverMatches: boolean;
    methodMatches: boolean;
    duplicateProof: boolean;
  };
}

export interface ValidateParams {
  orderId: string;
  paymentId: string;
  proofUrl: string;
  expectedAmount: number;
  expectedMethod: string;
  expectedReceiverNumber: string;
}

export interface ProofProcessResult {
  approved: boolean;
  rejectionReason: string | null;
}
