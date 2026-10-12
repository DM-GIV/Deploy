FROM python:3.12-alpine
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
# Build context is this directory (services/lead-intake/ or its copy in isolated/lead-intake/app).
COPY lead_intake.py /app/lead_intake.py
COPY vendor/__init__.py vendor/altcha_v1.py vendor/LICENSE.altcha-lib-py /app/vendor/
EXPOSE 8081
CMD ["python", "-m", "lead_intake"]
