FROM python:3.12-alpine
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY admin_core.py outbox.py admin_app.py /app/
COPY static /app/static
EXPOSE 8082
CMD ["python", "admin_app.py"]
