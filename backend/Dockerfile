FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
RUN python3 -m venv /opt/reebot-venv \
    && /opt/reebot-venv/bin/pip install --no-cache-dir -r requirements.txt
ENV PATH="/opt/reebot-venv/bin:$PATH"
ENV PYTHONDONTWRITEBYTECODE=1
COPY package.json package-lock.json ./
RUN npm ci
RUN npx playwright install --with-deps chromium
COPY . .
EXPOSE 3001
CMD ["npm", "start"]
