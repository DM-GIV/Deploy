FROM python:3.12-alpine
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY services/lead-intake/lead_intake.py /app/lead_intake.py
COPY services/lead-intake/vendor/__init__.py services/lead-intake/vendor/altcha_v1.py services/lead-intake/vendor/LICENSE.altcha-lib-py /app/vendor/
EXPOSE 8081
CMD ["python", "-m", "lead_intake"]
