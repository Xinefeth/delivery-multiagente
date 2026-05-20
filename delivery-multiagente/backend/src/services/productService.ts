import { prisma } from '../lib/prisma';
import { Product } from '@prisma/client';

export const productService = {
  async getAll(): Promise<Product[]> {
    return prisma.product.findMany({
      where: { is_available: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  },

  async findByName(name: string): Promise<Product | null> {
    const products = await this.getAll();
    const lower = name.toLowerCase().trim();
    return (
      products.find(p => p.name.toLowerCase() === lower) ??
      products.find(p => p.name.toLowerCase().includes(lower)) ??
      null
    );
  },

  formatForClaude(products: Product[]): string {
    const grouped = products.reduce((acc, p) => {
      if (!acc[p.category]) acc[p.category] = [];
      acc[p.category].push(p);
      return acc;
    }, {} as Record<string, Product[]>);

    return Object.entries(grouped)
      .map(([cat, items]) => {
        const lines = items.map(p => `  - ${p.name}: S/ ${p.price.toFixed(2)}${p.description ? ` (${p.description})` : ''}`);
        return `${cat}:\n${lines.join('\n')}`;
      })
      .join('\n\n');
  },

  formatMenu(products: Product[]): string {
    const grouped = products.reduce((acc, p) => {
      if (!acc[p.category]) acc[p.category] = [];
      acc[p.category].push(p);
      return acc;
    }, {} as Record<string, Product[]>);

    return Object.entries(grouped)
      .map(([cat, items]) => {
        const lines = items.map(p => `  • ${p.name} — S/ ${p.price.toFixed(2)}`);
        return `*${cat}*\n${lines.join('\n')}`;
      })
      .join('\n\n');
  },
};
