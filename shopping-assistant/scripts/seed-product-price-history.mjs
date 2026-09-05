#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

loadDotEnv(path.resolve('.env'));

const prisma = new PrismaClient();
const now = new Date();

try {
  const products = await prisma.product.findMany({
    select: {
      id: true,
      title: true,
      priceAmount: true,
      currency: true,
      rawPayloadJson: true,
    },
  });

  const historiesByProductId = new Map();
  let updatedProducts = 0;

  for (const product of products) {
    const amount = Number(product.priceAmount);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const rawPayload = parseJsonObject(product.rawPayloadJson);
    const history = buildPriceHistory({
      productId: product.id,
      currentAmount: amount,
      currency: product.currency || 'CNY',
      now,
    });

    rawPayload.priceHistory = history;
    await prisma.product.update({
      where: { id: product.id },
      data: { rawPayloadJson: JSON.stringify(rawPayload) },
    });
    historiesByProductId.set(product.id, history);
    updatedProducts += 1;
  }

  const candidateItems = await prisma.candidateItem.findMany({
    select: { id: true, rawPayloadJson: true },
  });
  let updatedCandidateItems = 0;

  for (const item of candidateItems) {
    const rawPayload = parseJsonObject(item.rawPayloadJson);
    const productPoolSource = asRecord(rawPayload.productPoolSource);
    const productId = stringOrNull(productPoolSource.productId);
    const history = productId ? historiesByProductId.get(productId) : null;
    if (!history) continue;

    const productRawPayload = asRecord(rawPayload.productRawPayload);
    productRawPayload.priceHistory = history;
    rawPayload.productRawPayload = productRawPayload;

    await prisma.candidateItem.update({
      where: { id: item.id },
      data: { rawPayloadJson: JSON.stringify(rawPayload) },
    });
    updatedCandidateItems += 1;
  }

  console.log(
    JSON.stringify(
      {
        updatedProducts,
        updatedCandidateItems,
        generatedAt: now.toISOString(),
      },
      null,
      2,
    ),
  );
} finally {
  await prisma.$disconnect();
}

function buildPriceHistory({ productId, currentAmount, currency, now }) {
  const random = mulberry32(hashString(productId));
  const pointCount = 12;
  const historyDays = 90;
  const premiumStart = 0.08 + random() * 0.16;
  const volatility = 0.025 + random() * 0.055;
  const phase = random() * Math.PI * 2;
  const points = [];

  for (let index = 0; index < pointCount; index += 1) {
    const t = index / (pointCount - 1);
    const date = new Date(
      now.getTime() - (historyDays - Math.round(historyDays * t)) * 24 * 60 * 60 * 1000,
    );
    const seasonal = Math.sin(t * Math.PI * 2.4 + phase) * volatility;
    const drift = premiumStart * (1 - t);
    const noise = (random() - 0.5) * volatility;
    const amount =
      index === pointCount - 1
        ? currentAmount
        : currentAmount * (1 + drift + seasonal + noise);
    points.push({
      date: date.toISOString().slice(0, 10),
      amount: roundMoney(Math.max(currentAmount * 0.86, amount)),
    });
  }

  const amounts = points.map((point) => point.amount);
  return {
    version: 1,
    source: 'generated_local_seed',
    generatedAt: now.toISOString(),
    currency,
    windowDays: historyDays,
    currentAmount: roundMoney(currentAmount),
    lowAmount: roundMoney(Math.min(...amounts)),
    highAmount: roundMoney(Math.max(...amounts)),
    averageAmount: roundMoney(
      amounts.reduce((sum, value) => sum + value, 0) / amounts.length,
    ),
    points,
  };
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return asRecord(parsed);
  } catch {
    return {};
  }
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function stringOrNull(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  return () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function loadDotEnv(envPath) {
  try {
    const content = readFileSync(envPath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const equals = trimmed.indexOf('=');
      if (equals <= 0) continue;
      const key = trimmed.slice(0, equals).trim();
      const value = trimmed.slice(equals + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // The Prisma client can still use an existing DATABASE_URL from the environment.
  }
}
