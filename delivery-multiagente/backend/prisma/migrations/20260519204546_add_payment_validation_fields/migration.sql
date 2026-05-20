/*
  Warnings:

  - Added the required column `updated_at` to the `payments` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'EN_VERIFICACION';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "detected_amount" DOUBLE PRECISION,
ADD COLUMN     "detected_method" TEXT,
ADD COLUMN     "detected_receiver_number" TEXT,
ADD COLUMN     "rejection_reason" TEXT,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
ADD COLUMN     "validated_at" TIMESTAMP(3),
ADD COLUMN     "validated_automatically" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "validation_confidence" DOUBLE PRECISION;
