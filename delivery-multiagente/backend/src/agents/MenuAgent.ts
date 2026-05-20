import { prisma } from '../lib/prisma';
import { Product } from '@prisma/client';

/**
 * MenuAgent
 * Responsabilidad: Mostrar menú, listar productos, validar disponibilidad.
 */
export class MenuAgent {
  async getProducts(): Promise<Product[]> {
    return prisma.product.findMany({ where: { is_available: true }, orderBy: [{ category: 'asc' }, { name: 'asc' }] });
  }

  async getFormattedMenu(): Promise<string> {
    const products = await this.getProducts();
    const grouped = this.groupByCategory(products);
    let menu = '';
    let index = 1;
    const productIndex: Record<number, string> = {};

    for (const [category, items] of Object.entries(grouped)) {
      menu += `*📌 ${category}*\n`;
      for (const item of items) {
        menu += `  ${index}. ${item.name} — S/ ${item.price.toFixed(2)}\n`;
        if (item.description) menu += `     _${item.description}_\n`;
        productIndex[index] = item.id;
        index++;
      }
      menu += '\n';
    }
    return menu.trim();
  }

  async findProductByNameOrNumber(input: string): Promise<Product | null> {
    const products = await this.getProducts();
    const num = parseInt(input);
    if (!isNaN(num)) {
      const sorted = products.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
      return sorted[num - 1] ?? null;
    }
    const lower = input.toLowerCase().trim();
    return (
      products.find(p => p.name.toLowerCase() === lower) ??
      products.find(p => p.name.toLowerCase().includes(lower)) ??
      null
    );
  }

  async validateProductAvailability(productId: string): Promise<boolean> {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    return product?.is_available ?? false;
  }

  async getProductById(id: string): Promise<Product | null> {
    return prisma.product.findUnique({ where: { id } });
  }

  private groupByCategory(products: Product[]): Record<string, Product[]> {
    return products.reduce((acc, p) => {
      if (!acc[p.category]) acc[p.category] = [];
      acc[p.category].push(p);
      return acc;
    }, {} as Record<string, Product[]>);
  }
}
